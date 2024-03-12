namespace ordermateAPI.Models;

public class AddOrderItemModel
{
    public int OrderItemId { get; set; }
    public int OrderId { get; set; }
    public int ProductOptionId { get; set; }
    public int Quantity { get; set; }
    
    public List<OrderItemModifier> Modifiers { get; set; }

    public class OrderItemModifier
    {
        public int ModifierId { get; set; }
        public int Quantity { get; set; }
    }
}