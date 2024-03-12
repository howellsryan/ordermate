using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class OrderItemRepository : IOrderItemRepository
{
    private readonly IDbContext _dbContext;

    public OrderItemRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<OrderItemModel?> Get(int orderItemId)
    {
        using var connection = _dbContext.CreateConnection();
        
        return await connection.QuerySingleOrDefaultAsync<OrderItemModel>(OrderItemScripts.Get, new { orderItemId });
    }

    public async Task<OrderItemModel?> GetByOrderIdAndProductOptionIdAndModifiers(int orderId, int productOptionId, List<ordermateAPI.Models.AddOrderItemModel.OrderItemModifier> modifiers)
    {
        using var connection = _dbContext.CreateConnection();
        
        var orderItems = (await connection.QueryAsync<OrderItemModel>(OrderItemScripts.GetByOrderIdAndProductOptionId, new { orderId, productOptionId })).ToList();
        if (orderItems.Count == 1)
            return orderItems.Single();

        foreach (var orderItem in orderItems)
        {
            bool duplicateItem = false;
            List<OrderItemModifierModel> existingOrderItemModifiers =
                (await connection.QueryAsync<OrderItemModifierModel>(
                    OrderItemModifierScripts.GetAllByOrderItem, new { orderItem.OrderItemId })).ToList();

            List<int> existingOrderItemModifierIds = existingOrderItemModifiers.Select(x => x.ModifierId).ToList();
            if (existingOrderItemModifierIds.All(modifiers.Select(x => x.ModifierId).ToList().Contains) && existingOrderItemModifiers.Count == modifiers.Count)
            {
                if (existingOrderItemModifiers.Count == 0)
                    duplicateItem = true;
                
                foreach (var existingOrderItemModifier in existingOrderItemModifiers)
                {
                    var addOrderItemModifier =
                        modifiers.Single(x => x.ModifierId == existingOrderItemModifier.ModifierId);

                    if (existingOrderItemModifier.Quantity != addOrderItemModifier.Quantity)
                        break;

                    duplicateItem = true;
                }

                if (duplicateItem)
                    return orderItem;
            }
        }

        return null;
    }

    public async Task<IEnumerable<OrderItemModel>> GetAllOrderItemsByOrderId(int orderId)
    {
        using var connection = _dbContext.CreateConnection();
        
        return await connection.QueryAsync<OrderItemModel>(OrderItemScripts.GetAllByOrderId, new { orderId });
    }

    public async Task AddItem(ordermateAPI.Models.AddOrderItemModel addOrderItem)
    {
        using var connection = _dbContext.CreateConnection();
        
        var orderItemId = await connection.QuerySingleAsync<int>(OrderItemScripts.AddItemToOrder,
            new { addOrderItem.OrderId, addOrderItem.ProductOptionId, addOrderItem.Quantity });

        foreach (var modifier in addOrderItem.Modifiers)
        {
            await connection.ExecuteAsync(OrderItemModifierScripts.AddModifierToOrderItem,
                new { orderItemId, modifier.ModifierId, modifier.Quantity });
        }
    }

    public async Task UpdateItemAndModifiers(ordermateAPI.Models.AddOrderItemModel addOrderItem)
    {
        using var connection = _dbContext.CreateConnection();
        
        await connection.ExecuteAsync(OrderItemScripts.UpdateOrderItem,
            new { addOrderItem.OrderItemId, addOrderItem.Quantity });
        
        foreach (var modifier in addOrderItem.Modifiers)
        {
            var orderItemModifierId = await connection.QuerySingleOrDefaultAsync<int>(OrderItemModifierScripts.GetByOrderItemIdAndModifierId, new { addOrderItem.OrderItemId, modifier.ModifierId });
            if (orderItemModifierId == 0)
            {
                await connection.ExecuteAsync(OrderItemModifierScripts.AddModifierToOrderItem,
                    new { addOrderItem.OrderItemId, modifier.ModifierId, modifier.Quantity });
            }
            else
            {
                await connection.ExecuteAsync(OrderItemModifierScripts.UpdateOrderItemModifier,
                    new { addOrderItem.OrderItemId, modifier.Quantity });
            }
        }
    }
    public async Task UpdateItem(ordermateAPI.Models.AddOrderItemModel addOrderItem)
    {
        using var connection = _dbContext.CreateConnection();
        
        await connection.ExecuteAsync(OrderItemScripts.UpdateOrderItem,
            new { addOrderItem.Quantity, addOrderItem.OrderItemId });
    }

    public async Task RemoveItem(int orderItemId)
    {
        using var connection = _dbContext.CreateConnection();
        
        await connection.ExecuteAsync(OrderItemScripts.RemoveOrderItemAndModifiers,
            new { orderItemId });
    }
}