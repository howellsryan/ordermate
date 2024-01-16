using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Enums;
using ordermateAPI.Exceptions;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class OrderService : IOrderService
{
    private readonly IOrderRepository _orderRepository;

    public OrderService(IOrderRepository orderRepository)
    {
        _orderRepository = orderRepository;
    }

    public async Task<OrderModel> GetByOrderNumber(string orderNumber)
    {
        var order = await _orderRepository.Get(orderNumber);
        if (order == null)
            throw new OrderNotFoundException($"Could not find an order with the Order Number: {orderNumber}");

        return MapDalObjectToApiModel(order);
    }

    public async Task Create(string email, int storeId)
    {
        await _orderRepository.Create(email, storeId);
    }
    
    private List<OrderModel> MapResultsToApi(IEnumerable<DAL.Models.OrderModel> dataModel)
    {
        var result = new List<OrderModel>();

        foreach (var order in dataModel)
        {
            result.Add(MapDalObjectToApiModel(order));
        }

        return result;
    }

    private OrderModel MapDalObjectToApiModel(DAL.Models.OrderModel order)
    {
        return new OrderModel
        {
            OrderId = order.OrderId,
            StoreId = order.StoreId,
            OrderNumber = order.OrderNumber,
            OrderStatus = (OrderStatus)order.OrderStatus,
            Email = order.Email,
            TotalValue = order.TotalValue,
            Notes = order.Notes,
            CompletedDate = order.CompletedDate,
            LastModifiedDate = order.LastModifiedDate,
            CreatedDate = order.CreatedDate
        };
    }
}